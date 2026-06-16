const authMiddleware = (req, res, next) => {
    // Exclude health and webhook endpoints from auth
    if (['/health', '/healthz', '/github/webhook', '/telegram/webhook'].includes(req.path)) {
        return next();
    }

    const apiKey = req.headers['x-api-key'];
    if (!apiKey || apiKey !== process.env.INTERCOM_API_KEY) {
        return res.status(401).json({ error: 'Unauthorized: Invalid or missing API Key' });
    }
    
    next();
};

module.exports = authMiddleware;
