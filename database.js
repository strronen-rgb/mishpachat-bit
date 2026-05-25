async function getFamilyDebt(userId) {
    const received = await get(`SELECT COALESCE(SUM(amount), 0) as total 
                                 FROM transactions 
                                 WHERE user_id = $1 AND type = 'receive'`, [userId]);
    const given = await get(`SELECT COALESCE(SUM(amount), 0) as total 
                             FROM transactions 
                             WHERE user_id = $1 AND type = 'give'`, [userId]);
    return {
        totalReceived: received.total,
        totalGiven: given.total,
        balance: given.total - received.total
    }; // החזר את האיזון
}