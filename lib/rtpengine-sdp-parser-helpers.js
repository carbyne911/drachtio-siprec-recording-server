

/* 
    This helper function as its name helps to get from a string which represents an SDP the allocated port.
    The passed SDP is created by RTPEngine.
    The extraction of the port is used by regex pattern matching
    Example of sdp: 
    v=0\r\no=CiscoSystemsSIP-GW-UserAgent 1017 6183 IN IP4 172.31.19.1\r\ns=SIP Call\r\nc=IN IP4 172.31.19.1\r\nt=0 0\r\nm=audio 19578 RTP/AVP 8 101 100\r\nc=IN IP4 172.31.19.1\r\na=label:1\r\na=rtpmap:8 PCMA/8000\r\na=rtpmap:101 telephone-event/8000\r\na=rtpmap:100 X-NSE/8000\r\na=fmtp:101 0-16\r\na=fmtp:100 192-194\r\na=sendonly\r\na=rtcp:19579\r\na=ptime:20\r\n
*/
exports.getAllocatedPorts = (rtpengineCallerSDP, rtpengineCalleeSDP) => {
    return new Promise((resolve, reject) => {
        const regexPattern = /m=audio \d* RTP/;
        const callerResult = rtpengineCallerSDP.match(regexPattern);
        const calleeResult = rtpengineCalleeSDP.match(regexPattern);

        if (callerResult.length !== 1 || calleeResult.length !== 1) {
            reject(`[CARBYNE][SDP-PARSER] Couldn't get allocated ports of the call out of RTPEngine allocated SDPs: callerSDP=${rtpengineCallerSDP}\n, calleeSDP=${rtpengineCalleeSDP}`);
        } else {
            const callerSplittedResult = callerResult[0].split(' ');
            const calleeSplittedResult = calleeResult[0].split(' ');
            if (callerSplittedResult.length !== 3 || calleeSplittedResult.length !== 3) {
                reject(`[CARBYNE][SDP-PARSER] RTPEngine allocated SDPs 'maudio' section is not in expected format: callerSDP=${rtpengineCallerSDP}\n, calleeSDP=${rtpengineCalleeSDP}`);
            }
            resolve([Number(callerSplittedResult[1]), Number(calleeSplittedResult[1])]);
        }
    });
}