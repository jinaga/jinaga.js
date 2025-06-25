// Simple test to verify our connection logging works
const { logGlobalConnectionStats } = require('./dist/http/fetch');

console.log('Testing connection stats logging...');
logGlobalConnectionStats();

// Simulate some activity
setTimeout(() => {
    console.log('After 1 second:');
    logGlobalConnectionStats();
}, 1000);