// MOCK: SMS verification is simulated. Any 6-digit code is accepted while this is true.
// Real SMS is out of scope (CLAUDE.md section 7). If this is ever false, verification refuses.
import "server-only";

export const MOCK_SMS_ENABLED = true;
