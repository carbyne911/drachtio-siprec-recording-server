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
    opts.logger.info(`[CARBYNE] Stopping RTPEngine for callID(Cisco-Guid)=${opts.callDetails['call-id']}`)
    rtpEngine.delete(rtpEngine.remote, opts.callDetails).then((response) => {
        opts.logger.info(`[CARBYNE] Closed RTPEngine response : ${JSON.stringify(response)}`);
    });
} 
/******************  CARBYNE END SECTION  ********************/

function allocateEndpoint(which, rtpEngine, opts) {
  const args = Object.assign({metadata: JSON.stringify({'Cisco-Guid': gcid})}, opts.callDetails, {
    'sdp': which === 'caller' ? opts.sdp1 : opts.sdp2,
    'replace': ['origin', 'session-connection'],
    'ICE': 'remove',
    'record call': 'yes'
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
      opts.logger.info(`[CARBYNE] Extracted ports successfully : caller=${callerPort}, callee=${calleePort}, callID(Cisco-Guid)=${opts.req.get('Cisco-Guid')}`);
      mfsAPI.sendStartPipelineRequest(opts.logger, callerPort, calleePort);
  })
  .catch(error => {
      opts.logger.error(error);
  });
  /******************  CARBYNE END SECTION  ********************/
  
  return srf.createUAS(opts.req, opts.res, {localSdp: payload});
}

function onCallEnd(rtpEngine, opts) {
    /****************  CARBYNE START SECTION  ********************/
    opts.logger.info(`[CARBYNE] SIP-REC Call dialog has ended: rtpEngine=${rtpEngine}`);
    /******************  CARBYNE END SECTION  ********************/
}
