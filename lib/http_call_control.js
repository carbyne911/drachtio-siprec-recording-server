require('dotenv').config();
const axios = require('axios');

const SERVICE = "MFS"
const EXTERNAL_SERVICES = "External-Services"

const REQUEST_BASE_URL = `${process.env.MFS_PROTOCOL}://${process.env.MFS_URL}:${process.env.MFS_PORT}/${SERVICE}/${EXTERNAL_SERVICES}`

const START_CALL_RECORDING_PIPELINE_REQUEST_URL = `${REQUEST_BASE_URL}/StartCallRecordingPipelineRequest`
const STOP_CALL_RECORDING_PIPELINE_REQUEST_URL = `${REQUEST_BASE_URL}/StopCallRecordingPipelineRequest`

let axios_headers_config = {
    'Content-Type': 'application/json',
    auth: {
        username: process.env.MFS_API_USER_ID,
        password: process.env.MFS_API_PASSWORD
    }
}

exports.sendStartPipelineRequest = (sip_rec_app_logger, payload) => {
    axios.post(START_CALL_RECORDING_PIPELINE_REQUEST_URL, payload, axios_headers_config)
    .then((response) => {
        const http_code = response.status;
        const mfs_status = response.data.status; 
        if (http_code == 200 && mfs_status) {
            sip_rec_app_logger.info("[CARBYNE][HTTP-API] Successfully sent call properties to MFS application")
        } else {
            const { cause } = response.data;
            sip_rec_app_logger.info(`[CARBYNE][HTTP-API] Failed to send call properties to MFS application: http_status_code=${http_code}, cause=${cause}`)
        }
    })
    .catch((error) => {
        sip_rec_app_logger.error(error);
    });
}
