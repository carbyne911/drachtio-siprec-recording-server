const parseSiprecPayload = require('./payload-parser');
const constructSiprecPayload = require('./payload-combiner');
const {getAvailableRtpengine} = require('./utils');
const { v4 } = require('uuid');
const debug = require('debug')('drachtio:siprec-recording-server');
/****************  CARBYNE START SECTION  ********************/
const mfsAPI = require('./http_call_control');
const sdpParser = require('./rtpengine-sdp-parser-helpers');
var gcid;

const X_INGRESS_LABEL = "X-Ingress-Label";
const CODEC_PCMA = "pcma";
const CODEC_PCMU = "pcmu";
const MIN_PORT = 0;
const MAX_PORT = 65535;
const CLOCK_RATE_8KHZ = 8000;
/******************  CARBYNE END SECTION  ********************/

module.exports = (req, res) => {
  gcid = req.get('Cisco-Guid');
  const callid = req.get('Cisco-Guid');
  const from = req.getParsedHeader('From');
  const logger = req.srf.locals.logger.child({callid});
  const opts = {
    req,
    res,
    logger,
    callDetails: {
      'call-id': callid,
      'from-tag': from.params.tag
    }
  };

  logger.info(`received SIPREC invite: ${req.uri}`);
  const rtpEngine = getAvailableRtpengine();

  parseSiprecPayload(opts)
    .then(allocateEndpoint.bind(null, 'caller', rtpEngine))
    .then(allocateEndpoint.bind(null, 'callee', rtpEngine))
    .then(respondToInvite)
    .then((dlg) => {
        logger.info(`call connected successfully, using rtpengine at ${JSON.stringify(rtpEngine.remote)}`);
        /****************  CARBYNE START SECTION  ********************/
        stopRTPSession(rtpEngine, opts);
        /******************  CARBYNE END SECTION  ********************/
        return dlg.on('destroy', onCallEnd.bind(null, rtpEngine, opts));
    })
    .catch((err) => {
      logger.error(`Error connecting call: ${err}`);
    });
};

/****************  CARBYNE START SECTION  ********************/
function stopRTPSession(rtpEngine, opts) {
    opts.logger.info(`[CARBYNE] Stopping RTPEngine for call-id=${opts.req.get('Call-ID')}, Cisco-Guid=${opts.req.get('Cisco-Guid')}`)
    rtpEngine.delete(rtpEngine.remote, opts.callDetails).then((response) => {
        opts.logger.info(`[CARBYNE] Closed RTPEngine response: call-id=${opts.req.get('Call-ID')}, Cisco-Guid=${opts.req.get('Cisco-Guid')}, response=${JSON.stringify(response)}`);
    });
} 
/******************  CARBYNE END SECTION  ********************/

function allocateEndpoint(which, rtpEngine, opts) {
  const args = Object.assign({metadata: JSON.stringify({'Cisco-Guid': gcid})}, opts.callDetails, {
    'sdp': which === 'caller' ? opts.sdp1 : opts.sdp2,
    'replace': ['origin', 'session-connection'],
    'ICE': 'remove',
    'record call': 'no'
  });
  if (which === 'callee') Object.assign(args, {'to-tag': v4()});

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

function respondToInvite(opts) {
    const srf = opts.req.srf;
    const payload = constructSiprecPayload(opts.rtpengineCallerSdp, opts.rtpengineCalleeSdp);
    
    /****************  CARBYNE START SECTION  ********************/
    initiateMFSNewCall(opts);
    /******************  CARBYNE END SECTION  ********************/
    
    return srf.createUAS(opts.req, opts.res, {localSdp: payload});
}

/****************  CARBYNE START SECTION  ********************/
function initiateMFSNewCall(opts) {
    const xIngressLabel = getSIPHeaderValue(opts, X_INGRESS_LABEL);
    
    let getCallPortsPromise;
    let getCodecsAndClockRatePromise;
    let rtpEngineCallerSDP = opts.rtpengineCallerSdp;
    let rtpEngineCalleeSDP = opts.rtpengineCalleeSdp;
    let callerAOR = JSON.stringify(opts.caller, null, 2);
    let calleeAOR = JSON.stringify(opts.callee, null, 2);

    if(xIngressLabel) {
        const isCallerResult = isSDPWithMatchingIngressLabel(xIngressLabel, rtpEngineCallerSDP);
        if (typeof isCallerResult === "boolean") {
            if (!isCallerResult) {
                rtpEngineCallerSDP = opts.rtpengineCalleeSdp;
                rtpEngineCalleeSDP = opts.rtpengineCallerSdp;
                callerAOR = JSON.stringify(opts.callee, null, 2);
                calleeAOR = JSON.stringify(opts.caller, null, 2);
            }
        } else {
            opts.logger.error(`[CARBYNE][SIPREC] Exception received while trying to figure out whose the caller using X-Ingress-Label header: exception=${isCallerResult}`);
        }
    } 

    getCallPortsPromise = sdpParser.getAllocatedPorts(rtpEngineCallerSDP, rtpEngineCalleeSDP);
    getCodecsAndClockRatePromise = sdpParser.getCodecAndClockRate(rtpEngineCallerSDP, rtpEngineCalleeSDP);
    opts.logger.info(`[CARBYNE][SIP-REC] Sides of the call for the session are: xIngressLabel=${xIngressLabel}, callerSDP=${rtpEngineCallerSDP}, callerAOR=${callerAOR}, calleeSDP=${rtpEngineCalleeSDP}, calleeAOR=${calleeAOR}, call-id=${opts.req.get('Call-ID')}, Cisco-Guid=${opts.req.get('Cisco-Guid')}`);
    
    Promise.all([getCallPortsPromise, getCodecsAndClockRatePromise]).then(([[callerPort, calleePort], [callerCodec, callerClockRate, calleeCodec, calleeClockRate]]) => {
        const validationError = hasCallValidProperties(callerPort, calleePort, callerCodec, callerClockRate, calleeCodec, calleeClockRate);
        if (!validationError) {
            opts.logger.info(`[CARBYNE][SDP-PARSER] Extracted call properties successfully: ingressStreamPort=${callerPort}, egressStreamPort=${calleePort}, ingressStreamCodec=${callerCodec}, ingressStreamClockRate=${callerClockRate}, egressStreamCodec=${calleeCodec}, egressStreamClockRate=${calleeClockRate}, call-id=${opts.req.get('Call-ID')}, Cisco-Guid=${opts.req.get('Cisco-Guid')}`);
            mfsAPI.sendStartPipelineRequest(opts.logger, 
            {
                'recordingID':  String(opts.req.get('Cisco-Guid')),
                'ingressStreamPort': Number(callerPort),
                'egressStreamPort': Number(calleePort),
                'ingressStreamCodec': String(callerCodec),
                'ingressStreamClockRate': Number(callerClockRate),
                'egressStreamCodec': String(calleeCodec),
                'egressStreamClockRate': Number(calleeClockRate)
            });
        } else {
            opts.logger.error(`[CARBYNE][SDP-PARSER] Couldn't receive call properties properly [${validationError}] for: call-id=${opts.req.get('Call-ID')}, Cisco-Guid=${opts.req.get('Cisco-Guid')}`);
        }
    }).catch(error => {
        opts.logger.error(error);
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
        return `invalid callerPort value ${calleePort}`;
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
    opts.logger.info(`[CARBYNE][SIP-REC] SIP-REC Call dialog has ended: call-id=${opts.req.get('Call-ID')}, Cisco-Guid=${opts.req.get('Cisco-Guid')}`);
    mfsAPI.sendStopPipelineRequest(opts.logger, 
    {
        'recordingID':  String(opts.req.get('Cisco-Guid'))
    });
    /******************  CARBYNE END SECTION  ********************/
}
