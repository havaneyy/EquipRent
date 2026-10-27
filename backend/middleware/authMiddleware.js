const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'equiprent_secret_key_101';

const verifyRole = (allowedRoles) => {
  return (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Access denied. No token provided.' });
    }

    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = decoded; // Contains { userId, email, role }

      // Check if user's role is permitted
      if (!allowedRoles.includes(req.user.role)) {
        return res.status(403).json({ 
          error: `Access forbidden. Role '${req.user.role}' is not authorized to perform this action.` 
        });
      }

      next();
    } catch (err) {
      res.status(403).json({ error: 'Invalid or expired token.' });
    }
  };
};

module.exports = verifyRole;