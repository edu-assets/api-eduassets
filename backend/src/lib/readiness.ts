export async function checkReadiness(
  checkDependency: () => Promise<unknown>,
  timeoutMs = 1500
): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      checkDependency(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('readiness timeout')), timeoutMs);
      }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
