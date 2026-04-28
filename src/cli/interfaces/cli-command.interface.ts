export interface CliCommand {
  name: string;
  description: string;
  run(args: string[]): Promise<void>;
}
