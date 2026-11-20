// Cloudflare needs an ES-module entry with a default export; the handlers themselves are CommonJS.
import worker from './cf-worker.js';
export default worker;
