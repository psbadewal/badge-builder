'use strict';

var express = require('express');
var mongoose = require('mongoose');
var models = require('../models/models.js');
var idea = require('../idea.js');
var helpers = require('../helpers.js');

var router = express.Router();

var sendError = function (res, err) {
  res.statusCode = 500;
  res.send(err);
};

var sendUnauthorized = function (res) {
  res.statusCode = 401;
  res.json({
    message: 'Unauthorized'
  });
};

var sendBadRequest = function (res) {
  res.statusCode = 400;
  res.json({
    message: 'Bad Request'
  });
};

var authorOrAdmin = function (req, badge) {
  return req.user.role === 'admin' || req.user.id === badge.author
};

var filterBadge = function (badge) {
  var content = {
    theme: badge.content.theme,
    elements: []
  };
  badge.content.elements.forEach(function (element) {
    // Could have used `delete element.answer`, but some
    // elements currently rely on an answer property.
    element.answer = '';
    content.elements.push(element);
  });
  return {
    title: badge.title,
    content: badge.content
  };
};


var requireUser = function (req, res, next) {
  if (!req.user) {
    return sendUnauthorized(res);
  }
  next();
};

router.get(['/user', '/badges/:id/user'], requireUser, function (req, res) {
  res.json({
    name: req.user.name,
    imageUrl: req.user.imageUrl,
    role: req.user.role
  });
});

router.get('/badges/:id', requireUser, function (req, res) {
  try {
    var _id = mongoose.Types.ObjectId(req.params.id);
    models.Badge.findOne({ _id: _id }, function (err, badge) {
      if (err) {
        return sendError(res, err);
      }
      res.json(filterBadge(badge));
    });
  } catch (err) {
    sendBadRequest(res);
  }
});

router.put('/badges/:id/answers', requireUser, function (req, res) {
  models.Badge.findById(req.params.id, function (err, badge) {
    if (err) {
      return sendError(res, err);
    }
    res.json(helpers.calculateResults(badge, req.body));
  });
});

router.post('/badges/:id/answers', requireUser, function (req, res) {
  models.Badge.findById(req.params.id, function (err, badge) {
    if (err) {
      return sendError(res, err);
    }
    var results = helpers.calculateResults(badge, req.body);
    var allCorrect = true;
    for (var key in results) {
      if (results[key] === false) {
        allCorrect = false;
        break;
      }
    }
    if (allCorrect) {
      idea.postResult(req.user.accessToken, {
        result: 'pass'
      }, function (response, body) {
        console.log('iDEA response with status code ' +
          response.statusCode + ':\n' +
          JSON.stringify(body)
        );
        if (response.statusCode === 400) {
          return res.json({
            error: 'You have already completed or not yet started this badge'
          });
        }
        var passed = body && body.result === 'success';
        if (passed) {
          res.json({
            redirectUrl: body.redirect_uri
          });
        } else {
          res.json({
            error: body && body.error || 'Failure when posting results'
          });
        }
      });
    }
  });
});

/*
* Author routes
*/

var requireAuthor = function (req, res, next) {
  if (!req.user || !req.user.role || req.user.role === 'user') {
    return sendUnauthorized(res);
  }
  next();
};

router.get('/author/badges/:id', requireAuthor, function (req, res) {
  models.Badge.findById(req.params.id, function (err, badge) {
    if (err) {
      return sendError(res, err);
    }
    if (!authorOrAdmin(req, badge)) {
      return sendUnauthorized(res);
    }
    res.json(badge);
  });
});

var updateValues = function (badge, req) {
  badge.title = req.body.title;
  badge.consumerKey = req.body.consumerKey;
  badge.consumerSecret = req.body.consumerSecret;
  badge.content = helpers.generateIds(req.body.content);
};

router.post('/author/badges', requireAuthor, function (req, res) {
  var badge = new models.Badge();

  badge.author = req.user && req.user.id || '';
  updateValues(badge, req);

  badge.save(function (err, badge) {
    if (err) {
      return sendError(res, err);
    }

    res.statusCode = 201;
    res.json({
      _id: badge._id
    });
  });
});

router.put('/author/badges/:id', requireAuthor, function (req, res) {
  models.Badge.findById(req.params.id, function (err, badge) {
    if (err) {
      return sendError(res, err);
    }
    if (!authorOrAdmin(req, badge)) {
      return sendUnauthorized(res);
    }

    updateValues(badge, req);

    badge.save(function (err) {
      if (err) {
        return sendError(res, err);
      }
      res.json({
        _id: badge._id
      });
    });
  });
});

router.get('/author/badges', requireAuthor, function (req, res) {
  models.Badge.find({}, 'title author', function (err, badges) {
    if (err) {
      return sendError(res, err);
    }
    var resultBadges = [];
    badges.forEach(function (badge) {
      if (authorOrAdmin(req, badge)) {
        resultBadges.push(badge);
      }
    });
    res.json(resultBadges);
  });
});

router.delete('/author/badges/:id', requireAuthor, function (req, res) {
  models.Badge.findById(req.params.id, function (err, badge) {
    if (err) {
      return sendError(res, err);
    }
    if (!authorOrAdmin(req, badge)) {
      return sendUnauthorized(res);
    }
    badge.remove(function (err) {
      if (err) {
        return sendError(res, err);
      }
      res.json({
        message: 'Deleted'
      });
    });
  });
});

/*
* Admin routes
*/

var requireAdmin = function (req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return sendUnauthorized(res);
  }
  next();
};

var getUsers = function (role, req, res) {
  models.User.find({ role: role }, function (err, users) {
    if (err) {
      return sendError(res, err);
    }
    res.json(users);
  });
};

router.get('/admin/admins', requireAdmin, function (req, res) {
  getUsers('admin', req, res);
});

router.get('/admin/authors', requireAdmin, function (req, res) {
  getUsers('author', req, res);
});

router.get('/admin/users', requireAdmin, function (req, res) {
  getUsers('user', req, res);
});

var changeRole = function (req, res, role) {
  models.User.findOne({ id: req.body.id }, function (err, user) {
    if (err || user === null) {
      return sendBadRequest(res);
    }
    user.role = role;
    user.save(function (err) {
      if (err) {
        return sendError(res, err);
      }
      res.json({
        id: user.id
      });
    });
  });
};

router.put('/admin/admins', requireAdmin, function (req, res) {
  changeRole(req, res, 'admin');
});

router.put('/admin/authors', requireAdmin, function (req, res) {
  changeRole(req, res, 'author');
});

module.exports = router;
