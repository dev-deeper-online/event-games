/** Reports a mistake in a content file by name. Games check theirs on import, so a mistake fails the build. */
export const contentCheck = (file: string) => (valid: boolean, problem: string) => {
  if (!valid) throw new Error(`content/${file}: ${problem}`);
};
