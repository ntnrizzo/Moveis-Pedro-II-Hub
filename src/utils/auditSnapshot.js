// Deliberately omit personal data, documents, credentials and nested payloads.
export function auditSnapshot(record) {
    if (!record || typeof record !== 'object') return null;
    return Object.fromEntries(['id', 'organization_id', 'status', 'created_at', 'updated_at']
        .filter(key => record[key] !== undefined)
        .map(key => [key, record[key]]));
}
