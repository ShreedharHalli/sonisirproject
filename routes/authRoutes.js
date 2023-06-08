const Router = require('express')
const authController = require('../controllers/authController');

const router = Router();


router.post('/register', authController.register_post);
router.get('/login', authController.login_get);
router.get('/customerPage', authController.customerPage_get);
router.get('/logout', authController.logout_get);
router.get('/soniSirPage', authController.soniSirPage_get);
router.post('/login', authController.login_post);
router.post('/issuecreditsendpoint', authController.issuecreditsendpoint_post);


module.exports = router;