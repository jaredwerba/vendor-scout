export async function resolve(specifier, context, next) {
  const relative = specifier.startsWith("./") || specifier.startsWith("../");
  if (!relative || /\.[cm]?[jt]sx?$/.test(specifier) || /\.json$/.test(specifier)) {
    return next(specifier, context);
  }
  try {
    return await next(specifier, context);
  } catch (error) {
    if (error?.code === "ERR_MODULE_NOT_FOUND") return next(`${specifier}.ts`, context);
    throw error;
  }
}
