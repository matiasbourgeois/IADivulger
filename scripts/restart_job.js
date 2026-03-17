const axios = require('axios');
const jobId = '46710947-5cc4-42d3-824b-235b01176962';
const url = `http://localhost:3001/api/jobs/${jobId}/status`;

async function restartJob() {
  try {
    const resp = await axios.patch(url, { status: 'GENERATING_ASSETS' });
    console.log('SUCCESS:', resp.status, resp.data);
  } catch (err) {
    console.error('FAILED:', err.response ? err.response.data : err.message);
  }
}

restartJob();
