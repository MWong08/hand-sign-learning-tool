// URL of a file in public/, relative to wherever the app is hosted. Vite sets BASE_URL from
// vite.config.js (base: "./"), so the same build works at http://localhost:5173/ and in a
// sub-folder such as https://<user>.github.io/<repo>/.
export const asset = (path) => `${import.meta.env.BASE_URL}${path}`;
