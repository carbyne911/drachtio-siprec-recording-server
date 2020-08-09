const parseSiprecPayload = require('./payload-parser');
const constructSiprecPayload = require('./payload-combiner');
const {getAvailableRtpengine} = require('./utils');
const uuidv4 = require('uuid/v4');
const debug = require('debug')('drachtio:siprec-recording-server');
/****************  CARBYNE START SECTION  ********************/
const mfsAPI = require('./http_call_control');
const sdpParser = require('./rtpengine-sdp-parser-helpers');
var gcid;
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
  if (which === 'callee') Object.assign(args, {'to-tag': uuidv4()});

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
  sdpParser.getAllocatedPorts(opts.rtpengineCallerSdp, opts.rtpengineCalleeSdp)
  .then(([callerPort, calleePort]) => {
      opts.logger.info(`[CARBYNE] Extracted ports successfully: ingressStreamPort=${callerPort}, egressStreamPort=${calleePort}, call-id=${opts.req.get('Call-ID')}, Cisco-Guid=${opts.req.get('Cisco-Guid')}`);
      mfsAPI.sendStartPipelineRequest(opts.logger, 
      {
          'recordingID':  String(opts.req.get('Cisco-Guid')),
          'ingressStreamPort': Number(callerPort),
          'egressStreamPort': Number(calleePort)
      });
  })
  .catch(error => {
      opts.logger.error(error);
  });
  opts.logger.info(`[CARBYNE][SIP-REC] Responding to INVITE with OK: call-id=${opts.req.get('Call-ID')}, Cisco-Guid=${opts.req.get('Cisco-Guid')}, \ncaller:\n${JSON.stringify(opts.req.caller, null, 2)}, \ncallee:\n${JSON.stringify(opts.req.callee, null, 2)}, \nrtpengineCallerSdp:\n${JSON.stringify(opts.req.rtpengineCallerSdp, null, 2)}, \rtpengineCalleeSdp:\n${JSON.stringify(opts.req.rtpengineCalleeSdp, null, 2)}`);
  /******************  CARBYNE END SECTION  ********************/
  
  return srf.createUAS(opts.req, opts.res, {localSdp: payload});
}

function onCallEnd(rtpEngine, opts) {
    /****************  CARBYNE START SECTION  ********************/
    opts.logger.info(`[CARBYNE][SIP-REC] SIP-REC Call dialog has ended: call-id=${opts.req.get('Call-ID')}, Cisco-Guid=${opts.req.get('Cisco-Guid')}`);
    mfsAPI.sendStopPipelineRequest(opts.logger, 
    {
        'recordingID':  String(opts.req.get('Cisco-Guid'))
    });
    /******************  CARBYNE END SECTION  ********************/
}
