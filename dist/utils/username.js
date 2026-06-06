export function normalizeUsername(username) {
    return username
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9_]/g, "");
}
