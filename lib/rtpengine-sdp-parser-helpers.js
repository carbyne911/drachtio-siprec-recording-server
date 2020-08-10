

/* 
    This helper function as its name helps to get from a string which represents an SDP the allocated port.
    The passed SDP is created by RTPEngine.
    The extraction of the port is used by regex pattern matching
    Example of sdp: 
    v=0\r\no=CiscoSystemsSIP-GW-UserAgent 1017 6183 IN IP4 172.31.19.1\r\ns=SIP Call\r\nc=IN IP4 172.31.19.1\r\nt=0 0\r\nm=audio 19578 RTP/AVP 8 101 100\r\nc=IN IP4 172.31.19.1\r\na=label:1\r\na=rtpmap:8 PCMA/8000\r\na=rtpmap:101 telephone-event/8000\r\na=rtpmap:100 X-NSE/8000\r\na=fmtp:101 0-16\r\na=fmtp:100 192-194\r\na=sendonly\r\na=rtcp:19579\r\na=ptime:20\r\n
*/
exports.getAllocatedPorts = (rtpengineCallerSDP, rtpengineCalleeSDP) => {
    return new Promise((resolve, reject) => {
        const regexPattern = /m=audio [0-9]* RTP/;
        const callerResult = rtpengineCallerSDP.match(regexPattern);
        const calleeResult = rtpengineCalleeSDP.match(regexPattern);

        if (!callerResult || !calleeResult) {
            reject(`[CARBYNE][SDP-PARSER] Didn't received a match of regex for fetching RTPEngine allocated SDPs ports: callerSDP=${rtpengineCallerSDP}, calleeSDP=${rtpengineCalleeSDP}`);
        } else if (callerResult.length !== 1 || calleeResult.length !== 1) {
            reject(`[CARBYNE][SDP-PARSER] Couldn't get allocated ports of the call out of RTPEngine allocated SDPs: callerSDP=${rtpengineCallerSDP}, calleeSDP=${rtpengineCalleeSDP}`);
        } else {
            const callerSplittedResult = callerResult[0].split(' ');
            const calleeSplittedResult = calleeResult[0].split(' ');
            if (callerSplittedResult.length !== 3 || calleeSplittedResult.length !== 3) {
                reject(`[CARBYNE][SDP-PARSER] RTPEngine allocated SDPs 'maudio' section is not in expected format: callerSDP=${rtpengineCallerSDP}, calleeSDP=${rtpengineCalleeSDP}`);
            }
            resolve([Number(callerSplittedResult[1]), Number(calleeSplittedResult[1])]);
        }
    });
}

exports.getCodecAndClockRate = (rtpengineCallerSDP, rtpengineCalleeSDP) => {
    return new Promise((resolve, reject) => {
        const regexPattern = /a=rtpmap:\d* PCM[A,U]\/[0-9]*/;
        const callerResult = rtpengineCallerSDP.match(regexPattern);
        const calleeResult = rtpengineCalleeSDP.match(regexPattern);

        if (!callerResult || !calleeResult) {
            reject(`[CARBYNE][SDP-PARSER] Didn't received a match of regex for fetching RTPEngine allocated SDPs codec/clock-rate: callerSDP=${rtpengineCallerSDP}, calleeSDP=${rtpengineCalleeSDP}`);
        } else if (callerResult.length !== 1 || calleeResult.length !== 1) {
            reject(`[CARBYNE][SDP-PARSER] Couldn't get codec/clock-rate of the call out of RTPEngine allocated SDPs: callerSDP=${rtpengineCallerSDP}, calleeSDP=${rtpengineCalleeSDP}`);
        } else {
            const callerSplittedResult = callerResult[0].split(' ');
            const calleeSplittedResult = calleeResult[0].split(' ');
            if (callerSplittedResult.length !== 2 || calleeSplittedResult.length !== 2) {
                reject(`[CARBYNE][SDP-PARSER] RTPEngine allocated SDPs 'rtpmap' section for codec and clock-rate is not in expected format: callerSDP=${rtpengineCallerSDP}, calleeSDP=${rtpengineCalleeSDP}`);
            } else {
                try {
                    const callerCodecAndClockRate = callerSplittedResult[1].split('/'); // [0] - PCMA/U, [1] - 8000, 16000, ...
                    const calleeCodecAndClockRate = calleeSplittedResult[1].split('/'); // [0] - PCMA/U, [1] - 8000, 16000, ...
    
                    const callerCodec = String(callerCodecAndClockRate[0]);
                    const callerClockRate = Number(callerCodecAndClockRate[1]);
                    const calleeCodec = String(calleeCodecAndClockRate[0]);
                    const calleeClockRate = Number(calleeCodecAndClockRate[1]);
                    resolve([callerCodec, callerClockRate, calleeCodec, calleeClockRate]);
                } catch (error) {
                    reject(`[CARBYNE][SDP-PARSER] Invalid values of codec/clock-rate inside RTPEngine allocated SDPs: callerSDP=${rtpengineCallerSDP}, calleeSDP=${rtpengineCalleeSDP}`);
                }
            }
        }
    });
}