import { describe, expect, it } from 'vitest';
import { crashDetails, scrubCrashText } from './crash';

describe('crash reports', () => {
  it('mask anything that looks personal', () => {
    expect(scrubCrashText('Mail to ravi@shop.example failed for 98765 43210 and 4111-1111-1111-1111')).toBe('Mail to <email> failed for <number> and <number>');
    expect(scrubCrashText('token eyJhbGciOi.eyJzdWIi.sig, key fb1abcdefghijklmnopqrstuvwxyz0123456789ABCDEF')).toBe('token <token>, key <token>');
    expect(scrubCrashText('GSTIN 27AAACR5055K1Z7 rejected')).toBe('GSTIN <gstin> rejected');
    expect(scrubCrashText('GET https://pos.example/api/sales?q=ravi&x=1 failed')).toBe('GET https://pos.example/api/sales?<query> failed');
    expect(scrubCrashText('at C:\\Users\\Ravi Kumar\\AppData\\x.js and /home/ravi/app/main.js')).toBe('at C:\\Users\\<user>\\AppData\\x.js and /home/<user>/app/main.js');
  });

  it('keep the first line of the message and only the stack frames', () => {
    const error = new TypeError("Cannot read properties of undefined (reading 'qty')\nInvalid `prisma.customer.create()` invocation: { name: 'Ravi', phone: '9876543210' }");
    error.stack = `TypeError: Cannot read properties of undefined\n    at checkout (/home/ravi/app/dist/sales.js:10:5)\n  { name: 'Ravi' }\n    at async Promise.all (index 0)`;
    const details = crashDetails(error);
    expect(details.message).toBe("TypeError: Cannot read properties of undefined (reading 'qty')");
    expect(details.stack).toBe('at checkout (/home/<user>/app/dist/sales.js:10:5)\nat async Promise.all (index 0)');
    expect(crashDetails('boom').message).toBe('boom');
  });
});
