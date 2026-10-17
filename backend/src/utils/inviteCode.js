const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function createInviteCode(length = 8) {
  let code = 'IQ';
  for (let index = 0; index < length - 2; index += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

module.exports = { createInviteCode };
