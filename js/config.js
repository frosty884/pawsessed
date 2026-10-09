// Party site settings.
// apiUrl: paste the Google Apps Script web app URL here (ends in /exec). See README.md, "Connect the Google Sheet".
// Until it is set, the song requests and raffle sections say they open soon and nothing is sent anywhere.
window.PAWSESSED = {
  apiUrl: '',
  pollMs: 15000,
  // party nights, Wisconsin Dells time (CDT, UTC-5): 8PM until 2AM the next morning
  nights: ['2026-10-09', '2026-10-10', '2026-10-11'],
  utcOffset: '-05:00',
  startTime: '20:00',
  hours: 6,
};
