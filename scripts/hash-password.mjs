/**
 * Prints a BORS_PASSWORD_HASH value for the hosted login.
 * Run: npm run hash-password            (asks for the password, input hidden)
 *      npm run hash-password -- <pw>    (non-interactive)
 */
import crypto from "node:crypto";
import readline from "node:readline";

function hash(password) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(password, salt, 64);
  return `scrypt:${salt.toString("base64")}:${h.toString("base64")}`;
}

async function askHidden(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  rl._writeToOutput = (s) => {
    if (s.includes(prompt)) rl.output.write(s);
  };
  const answer = await new Promise((resolve) => rl.question(prompt, resolve));
  rl.close();
  process.stdout.write("\n");
  return answer;
}

const arg = process.argv[2];
const password = arg ?? (await askHidden("Password: "));
if (!password || password.length < 10) {
  console.error("Use a password of at least 10 characters.");
  process.exit(1);
}
console.log(hash(password));
