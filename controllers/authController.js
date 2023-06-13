const User = require('../models/User');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');


// handle errors
const handleErrors = (err) => {
    let errors = { email: '', password: '' };

    //login stage
    // incorrect email
    if (err.message === 'incorrect email') {
        errors.email = 'that email is not registered';
    }

    // incorrect password
    if (err.message === 'incorrect password') {
        errors.password = 'that password is incorrect';
    }


    //duplicate email error code
    if (err.code === 11000) {
        errors.email = 'that email already exists';
        return errors;
    }


    //validation errors
    if (err.message.includes('user validation failed')) {
        Object.values(err.errors).forEach(({properties}) => {
            errors[properties.path] = properties.message;
        }
    )}
    return errors;

};

const maxAge = 3 * 24 * 60 * 60;
const createToken = (id) => {
    return jwt.sign({ id }, 'mayu secret', {
        expiresIn: maxAge
    });
};


module.exports.register_post = async (req, res) => {
    const { fullName, email, password } = req.body;
    try {
        const user = await User.create({fullName, email, password});
        const token = createToken(user._id)
        res.cookie('jwt', token, { httpOnly: true, maxAge: maxAge * 1000});
        res.status(200).json({ user: user._id});
    } catch (error) {
        const errors = handleErrors(error);
        res.status(400).json({ errors });
    }
};



module.exports.login_get = (req, res) => {
    res.render('login')
};

module.exports.customerPage_get = (req, res) => {
    res.render('customerpage')
};

module.exports.login_post = async (req, res) => {
    let { email, password } = req.body;

    try {
        const user = await User.login(email, password);
        const token = createToken(user._id)
        res.cookie('jwt', token, { httpOnly: true, maxAge: maxAge * 1000});
        res.status(200).json({ user: user._id, email: user.email });
    } catch (error) {
        let errors = handleErrors(error);
        res.status(400).json({errors});
    }

};

module.exports.logout_get = (req, res) => {
    res.cookie('jwt', '', { httpOnly: true, maxAge: 1}); // in short we are removing the cookie
    res.redirect('/login');
};

module.exports.soniSirPage_get = (req, res) => {
    res.render('sonisirpage')
};

module.exports.issuecreditsendpoint_post = async (req, res) => {
    let { customerid, credits } = req.body;
    try {
        const updatedCredits = await User.updateOne({ _id: customerid }, { $inc: { AvailableCredits: credits } });
        res.status(200).json(updatedCredits);
    } catch (error) {
        res.status(400).json(error.message);
    }
};

module.exports.deletecustomer_post = async (req, res) => {
    let { customerid } = req.body;
    try {
        const deleteCustomer = await User.deleteOne({ _id: new mongo.ObjectId(customerid) }, function (err, result) { 
            console.log(err);    
            console.log(result);    
        });
        console.log(deleteCustomer);
        res.status(200).json({ message: 'success' });
    } catch (error) {
        res.status(400).json( { message: 'error' });
    }
};

