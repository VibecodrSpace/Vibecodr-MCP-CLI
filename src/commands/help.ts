import { isHelpToken } from "../cli/parse.js";
import type { CommandContext } from "./context.js";

export function showHelpIfRequested(args: string[], _context: CommandContext, text: string): boolean {
  if (!args.some((arg) => isHelpToken(arg))) return false;
  process.stdout.write(`${text}\n`);
  return true;
}
