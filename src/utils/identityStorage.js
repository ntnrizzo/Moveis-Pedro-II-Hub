export function identityKey(name, organizationId, userId) {
    if (!organizationId || !userId) throw new Error('Identidade obrigatória para persistência');
    return `${name}:${organizationId}:${userId}`;
}

export function offlineSalesStore(organizationId, userId, storage = localStorage) {
    const key = identityKey('pending_sales_offline', organizationId, userId);
    const get = () => JSON.parse(storage.getItem(key) || '[]').filter(s =>
        s.organization_id === organizationId && s.offlineUserId === userId);
    return {
        get,
        save(sale) {
            const offlineId = crypto.randomUUID();
            storage.setItem(key, JSON.stringify([...get(), {
                ...sale, id: offlineId, offlineId, organization_id: organizationId,
                offlineUserId: userId, timestamp: new Date().toISOString(),
            }]));
            return true;
        },
        remove(id) { storage.setItem(key, JSON.stringify(get().filter(s => s.offlineId !== id))); },
    };
}
