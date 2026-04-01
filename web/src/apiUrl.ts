export const API_URL = (() => {
  const envUrl = (import.meta.env.VITE_API_URL as string | undefined) ?? "";
  const cleaned = envUrl.trim();
  if (cleaned) return cleaned;
  const host = typeof window !== "undefined" ? window.location.hostname : "localhost";
  return `http://${host}:3001`;
})();

