const parseSiprecPayload = require('./payload-parser');
const constructSiprecPayload = require('./payload-combiner');
const {getAvailableRtpengine} = require('./utils');
const { uuid } = require('uuidv4');
const debug = require('debug')('drachtio:siprec-recording-server');
/****************  CARBYNE START SECTION  ********************/
const mfsAPI = require('./http_call_control');
const sdpParser = require('./rtpengine-sdp-parser-helpers');
const X_INGRESS_LABEL = "X-Ingress-Label";
const CISCO_GUID = "Cisco-Guid";
const X_CALL_ID = "X-Call-ID";
const X_PARENT_CALL_ID = "X-Parent-Call-ID";
const CODEC_PCMA = "pcma";
const CODEC_PCMU = "pcmu";
const MIN_PORT = 0;
const MAX_PORT = 65535;
const CLOCK_RATE_8KHZ = 8000;
/******************  CARBYNE END SECTION  ********************/

module.exports = (req, res) => {
  const callid = req.get(X_CALL_ID) || req.get(CISCO_GUID);
  const from = req.getParsedHeader('From');
  const logger = req.srf.locals.logger.child({callid});
  const opts = {
    req,
    res,
    logger,
    callid,
    callDetails: {
      'call-id': callid,
      'from-tag': from.params.tag
    }
  };

  opts.parentCallId = req.get(X_PARENT_CALL_ID);

  logger.info(`[CARBYNE][SIP-REC] received SIPREC invite: uri=${req.uri}, callID=${callid}, X-Parent-Call-ID=${opts.parentCallId || 'none'}`);
  const rtpEngine = getAvailableRtpengine();

  parseSiprecPayload(opts)
    .then(allocateEndpoint.bind(null, 'caller', rtpEngine))
    .then(allocateEndpoint.bind(null, 'callee', rtpEngine))
    .then((opts) => ensurePortsNotInUseWithMfs(rtpEngine, opts))
    .then(respondToInvite)
    .then((dlg) => {
        logger.info(`call connected successfully, using rtpengine at ${JSON.stringify(rtpEngine.remote)}`);
        /****************  CARBYNE START SECTION  ********************/
        stopRTPSession(rtpEngine, opts);
        opts.startCompleted = false;
        opts.startSucceeded = false;
        opts.stopPending = false;
        opts.startPromise.then((started) => {
            opts.startCompleted = true;
            opts.startSucceeded = started;
            if (opts.stopPending && started) {
                onCallEnd(rtpEngine, opts);
            }
        });
        dlg.on('destroy', () => {
            if (opts.startCompleted) {
                if (opts.startSucceeded) {
                    onCallEnd(rtpEngine, opts);
                }
            } else {
                opts.stopPending = true;
            }
        });
        /******************  CARBYNE END SECTION  ********************/
        return dlg;
    })
    .catch((err) => {
      logger.error(`Error connecting call: ${err}`);
    });
};

/****************  CARBYNE START SECTION  ********************/
function stopRTPSession(rtpEngine, opts) {
    opts.logger.info(`[CARBYNE] Stopping RTPEngine for callID=${opts.callid}`)
    rtpEngine.delete(rtpEngine.remote, opts.callDetails).then((response) => {
        opts.logger.info(`[CARBYNE] Closed RTPEngine response: callID=${opts.callid}, response=${JSON.stringify(response)}`);
    });
}
/******************  CARBYNE END SECTION  ********************/

function allocateEndpoint(which, rtpEngine, opts) {
  const args = Object.assign({metadata: JSON.stringify({'callID': opts.callid})}, opts.callDetails, {
    'sdp': which === 'caller' ? opts.sdp1 : opts.sdp2,
    'replace': ['origin', 'session-connection'],
    'ICE': 'remove',
    'record call': 'no'
  });
  if (which === 'callee') Object.assign(args, {'to-tag': uuid()});

  debug(`callDetails: ${opts.callDetails}`);
  debug(`rtpengine args for ${which}: ${JSON.stringify(args)}, sending to ${JSON.stringify(rtpEngine.remote)}`);
  return rtpEngine[which === 'caller' ? 'offer' : 'answer'](rtpEngine.remote, args)
    .then((response) => {
      if (response.result !== 'ok') {
        throw new Error('error connecting to rtpengine');
      }
      opts[which === 'caller' ? 'rtpengineCallerSdp' : 'rtpengineCalleeSdp'] = response.sdp;
      return opts;
    });
}

/****************  CARBYNE START SECTION  ********************/
const MAX_PORT_COLLISION_RETRIES = 3;

function ensurePortsNotInUseWithMfs(rtpEngine, opts, attempt = 0) {
    return sdpParser.getAllocatedPorts(opts.rtpengineCallerSdp, opts.rtpengineCalleeSdp)
        .then(([callerPort, calleePort]) => mfsAPI.checkPortsInUse(opts.logger, [Number(callerPort), Number(calleePort)]))
        .then((portsInUse) => {
            if (!portsInUse || portsInUse.length === 0) {
                return opts;
            }
            opts.logger.error(`[CARBYNE][SIP-REC] MFS reports allocated ports still in use by a stale session: portsInUse=${JSON.stringify(portsInUse)}, callID=${opts.callid}, attempt=${attempt}`);
            if (attempt >= MAX_PORT_COLLISION_RETRIES - 1) {
                opts.logger.error(`[CARBYNE][SIP-REC] Giving up re-allocating ports after ${MAX_PORT_COLLISION_RETRIES} attempts, proceeding with the reported in-use ports for callID=${opts.callid}`);
                return opts;
            }
            return rtpEngine.delete(rtpEngine.remote, opts.callDetails)
                .then(() => allocateEndpoint('caller', rtpEngine, opts))
                .then((opts) => allocateEndpoint('callee', rtpEngine, opts))
                .then((opts) => ensurePortsNotInUseWithMfs(rtpEngine, opts, attempt + 1));
        })
        .catch((err) => {
            opts.logger.error(`[CARBYNE][SIP-REC] Failed to check allocated ports with MFS, proceeding without the check: callID=${opts.callid}, error=${err}`);
            return opts;
        });
}
/******************  CARBYNE END SECTION  ********************/

function respondToInvite(opts) {
    const srf = opts.req.srf;
    const payload = constructSiprecPayload(opts.rtpengineCallerSdp, opts.rtpengineCalleeSdp);

    /****************  CARBYNE START SECTION  ********************/
    opts.startPromise = initiateMFSNewCall(opts);
    /******************  CARBYNE END SECTION  ********************/

    return srf.createUAS(opts.req, opts.res, {localSdp: payload});
}

/****************  CARBYNE START SECTION  ********************/
function optionalHeader(opts, name) {
    const value = opts.req.get(name);
    if (value == null || value === '') {
        return undefined;
    }
    return String(value);
}

function optionalParty(party) {
    if (!party) {
        return undefined;
    }
    const out = {};
    if (party.aor) out.aor = String(party.aor);
    if (party.name) out.name = String(party.name);
    if (party.number) out.number = String(party.number);
    return Object.keys(out).length ? out : undefined;
}

function initiateMFSNewCall(opts) {
    const xIngressLabel = getSIPHeaderValue(opts, X_INGRESS_LABEL);

    let getCallPortsPromise;
    let getCodecsAndClockRatePromise;
    let rtpEngineCallerSDP = opts.rtpengineCallerSdp;
    let rtpEngineCalleeSDP = opts.rtpengineCalleeSdp;
    let callerParty = opts.caller;
    let calleeParty = opts.callee;

    if(xIngressLabel) {
        const isCallerResult = isSDPWithMatchingIngressLabel(xIngressLabel, rtpEngineCallerSDP);
        if (typeof isCallerResult === "boolean") {
            if (!isCallerResult) {
                rtpEngineCallerSDP = opts.rtpengineCalleeSdp;
                rtpEngineCalleeSDP = opts.rtpengineCallerSdp;
                callerParty = opts.callee;
                calleeParty = opts.caller;
            }
        } else {
            opts.logger.error(`[CARBYNE][SIPREC] Exception received while trying to figure out whose the caller using X-Ingress-Label header: exception=${isCallerResult}`);
        }
    }

    const callerAOR = JSON.stringify(callerParty, null, 2);
    const calleeAOR = JSON.stringify(calleeParty, null, 2);
    getCallPortsPromise = sdpParser.getAllocatedPorts(rtpEngineCallerSDP, rtpEngineCalleeSDP);
    getCodecsAndClockRatePromise = sdpParser.getCodecAndClockRate(rtpEngineCallerSDP, rtpEngineCalleeSDP);
    opts.logger.info(`[CARBYNE][SIP-REC] Sides of the call for the session are: xIngressLabel=${xIngressLabel}, callerSDP=${rtpEngineCallerSDP}, callerAOR=${callerAOR}, calleeSDP=${rtpEngineCalleeSDP}, calleeAOR=${calleeAOR}, callID=${opts.callid}`);
    return Promise.all([getCallPortsPromise, getCodecsAndClockRatePromise]).then(([[callerPort, calleePort], [callerCodec, callerClockRate, calleeCodec, calleeClockRate]]) => {
        const validationError = hasCallValidProperties(callerPort, calleePort, callerCodec, callerClockRate, calleeCodec, calleeClockRate);
        if (!validationError) {
            const recordingID = opts.callid;
            const tenantId = optionalHeader(opts, 'X-CNC-ID') || optionalHeader(opts, 'X-Tenant-ID');
            const sipCallId = optionalHeader(opts, 'Call-ID');
            const startPayload = {
                'recordingID': recordingID,
                'ingressStreamPort': Number(callerPort),
                'egressStreamPort': Number(calleePort),
                'ingressStreamCodec': String(callerCodec),
                'ingressStreamClockRate': Number(callerClockRate),
                'egressStreamCodec': String(calleeCodec),
                'egressStreamClockRate': Number(calleeClockRate)
            };
            if (opts.parentCallId) {
                startPayload.parentRecordingID = opts.parentCallId;
            }
            if (tenantId) {
                startPayload.tenantId = tenantId;
                startPayload.compositeRecordId = `${tenantId}_${recordingID}`;
            }
            if (sipCallId) {
                startPayload.sipCallId = sipCallId;
            }
            const caller = optionalParty(callerParty);
            const callee = optionalParty(calleeParty);
            if (caller) startPayload.caller = caller;
            if (callee) startPayload.callee = callee;
            opts.logger.info(`[CARBYNE][SDP-PARSER] Extracted call properties successfully: ingressStreamPort=${callerPort}, egressStreamPort=${calleePort}, ingressStreamCodec=${callerCodec}, ingressStreamClockRate=${callerClockRate}, egressStreamCodec=${calleeCodec}, egressStreamClockRate=${calleeClockRate}, recordingID=${recordingID}, parentRecordingID=${opts.parentCallId || 'none'}, tenantId=${tenantId || 'none'}`);
            return mfsAPI.sendStartPipelineRequest(opts.logger, startPayload);
        } else {
            opts.logger.error(`[CARBYNE][SDP-PARSER] Couldn't receive call properties properly [${validationError}] for: callID=${opts.callid}`);
            return false;
        }
    }).catch(error => {
        opts.logger.error(error);
        return false;
    });
}

function isSDPWithMatchingIngressLabel(xIngressLabel, rtpengineParticipantSDP) {
    try {
        var regexPattern = new RegExp(`a=label:${xIngressLabel}`, 'gi');
        return rtpengineParticipantSDP.match(regexPattern) != null;
    } catch (e) {
        return e;
    }
}

function getSIPHeaderValue(opts, headerName) {
    return opts.req.get(headerName);
}

function hasCallValidProperties(callerPort, calleePort, callerCodec, callerClockRate, calleeCodec, calleeClockRate) {
    if (callerPort < MIN_PORT || callerPort > MAX_PORT) {
        return `invalid callerPort value ${callerPort}`;
    } else if (calleePort < MIN_PORT || calleePort > MAX_PORT) {
        return `invalid calleePort value ${calleePort}`;
    } else if (!(callerCodec.toLowerCase().includes(CODEC_PCMA) || callerCodec.toLowerCase().includes(CODEC_PCMU))) {
        return `invalid callerCodec value ${callerCodec}`;
    } else if (!(calleeCodec.toLowerCase().includes(CODEC_PCMA) || calleeCodec.toLowerCase().includes(CODEC_PCMU))) {
        return `invalid calleeCodec value ${calleeCodec}`;
    } else if (callerClockRate != CLOCK_RATE_8KHZ) {
        return `invalid callerClockRate value ${callerClockRate}`;
    } else if (calleeClockRate != CLOCK_RATE_8KHZ) {
        return `invalid calleeClockRate value ${calleeClockRate}`;
    } else {
        return null;
    }
}
/******************  CARBYNE END SECTION  ********************/


function onCallEnd(rtpEngine, opts) {
    /****************  CARBYNE START SECTION  ********************/
    opts.logger.info(`[CARBYNE][SIP-REC] SIP-REC Call dialog has ended: callID=${opts.callid}`);
    mfsAPI.sendStopPipelineRequest(opts.logger, { recordingID: opts.callid });
    /******************  CARBYNE END SECTION  ********************/
}
