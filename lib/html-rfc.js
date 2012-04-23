var fs    = require('fs');
var path  = require('path');
var jsdom = require('jsdom');
var xhr   = require("xmlhttprequest");
var pretty = require('./html-pretty').pretty;

var jquery_path = path.resolve(path.dirname(module.filename),
                               "../data/jquery-1.7.2.min.js")

var jquery = fs.readFileSync(jquery_path).toString();

var Nit = function(dir, name) {
    this.name = name;
    this.path = fs.realpathSync(path.join(dir, name));
    this.promise = null;
    this.nit = require(this.path).nit;
    this.requires = []

    if (Array.isArray(this.nit.requires)) {
        for (var i=0; i<this.nit.requires.length; i++) {
            this.requires.push(getNit(dir, this.nit.requires[i]));
        }
    } else if (typeof(this.nit.requires) === "string") {
        this.requires.push(getNit(this.nit.requires));
    }
}

Nit.prototype.call = function(environment) {
    if (!this.promise) {
        var $ = environment.$;
        var all = [];
        $.each(this.requires, function() {
            all.push(this.call(environment));
        });
        all.push($.when(this.nit(environment)));
        this.promise = $.when.apply($, all);
    }
    return this.promise;
}

var allNits = {}
var getNit = function(dir, name) {
    if (allNits.hasOwnProperty(name)) {
        return allNits[name];
    }
    var n = new Nit(dir, name);
    allNits[name] = n;
    return n;
}

var runNits = function(environment, nitDir, files) {
    var $ = environment.$;
    var all = [];
    for (var i=0; i<files.length; i++) {
        var fname = files[i];
        if (fname.match(/\.js$/)) {
            all.push(getNit(nitDir, fname).call(environment));
        }
    }

    return $.when.apply($, all);
};

exports.lint = function(nitDir, inputStream, outputStream, callback) {
    fs.readdir(nitDir, function(err, files) {
        if (err) {
            callback("Bad nitDir(" + nitDir + "): " + err);
        } else {
            // capture the start time so it's the same for all nits
            var environment = {};
            Object.defineProperty(environment, 'timestamp', {
                value: new Date(),
                enumerable: true
            });

            jsdom.env({
                html: inputStream,
                src: [ jquery ],
                done: function(errors, window) {
                    if (errors) {
                        callback("Parse error: " + errors);
                    } else {
                        window.$.ajaxSettings.xhr = function() {
                            return new xhr.XMLHttpRequest();
                        }
                        window.$.ajaxSettings.converters['text xml'] = function(data) {
                            return window.$(jsdom.jsdom(data));
                        }
                        window.$.support.cors = true;

                        Object.defineProperty(environment, '$', {
                            value: window.$,
                            enumerable: true
                        });
                        Object.defineProperty(environment, 'document', {
                            value: window.Document,
                            enumerable: true
                        });
                        runNits(environment, nitDir, files)
                            .done(function() { pretty(window.document, outputStream); })
                            .fail(function() {
                                callback("runNit fail: " + arguments);
                            })
                            .always(callback);
                    }
                }
            });
        }
    });
};