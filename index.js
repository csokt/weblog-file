/* global require */
/* global module */
/* global process */

var weblogFile = function(setup, line2arr) {
  setup.host  = setup.host ? setup.host : require("ip").address()
  setup.topic = setup.domain+"."+setup.host+"."+setup.service

  var _ = require("lodash")
  var fs = require("fs")
  var glob = require("glob")
  var split = require("split")
  var FsTail = require("fs-tail")
  var autobahn = require("autobahn")

  var files = glob.sync(setup.pattern)
  var linecount = 0

  var filesize = 0
  setInterval(function () {
    fs.stat(files[0], function (err, stats) {
      if (filesize > stats.size) process.exit(8)
      filesize = stats.size
    })
  }, 10000)

  var connection = new autobahn.Connection({
    url: process.argv[2] || "ws://127.0.0.1:8080/ws",
    realm: process.argv[3] || "weblog"
  })

  var main = function(session) {
    var publish2topic = false
    var tail = FsTail(files[0], { start: 0, EOFAfter: 100 })
    tail.on("EOF", function() { publish2topic = true })
    tail.pipe(split())
      .on("data", function (line) {
        linecount++
        if (publish2topic) session.publish(setup.topic, line2arr(linecount, line))
      })

    session.subscribe("discover", function() {
      session.publish("announce", [setup])
    })

    session.register(setup.topic+".header", function() {
      return _.map(files, function(file) {
        return { file: file, header: setup.header }
      })
    })

    session.register(setup.topic+".reload", function(args) {
      return readlines(args)
    })

    var readlines = function(args) {
      var zlib = require("zlib")
      var when = require("when")
      var controls = args[0]
      var file = controls.header.file
      var begin    = controls.begin  ? new RegExp(controls.begin,  "i") : /(?:)/
      var end      = controls.end    ? new RegExp(controls.end,    "i") : /(?!x)x/
      var filter   = controls.filter ? new RegExp(controls.filter, "i") : /(?:)/
      var comment  = setup.comment || /(?!x)x/
      var res = [], counter = 0, i = 0, start = false, stop = false
      var d = when.defer()
      var startline = controls.offset >= 0 ? controls.offset : linecount + controls.offset
      var st1 = fs.createReadStream(file)
      var st2 = /\.gz$/.test(file) ? st1.pipe(zlib.createGunzip()) : st1
      st2.setEncoding("utf8")
      var st3 = split()
      st2.pipe(st3)
        .on("data", function (line) {
          i++
          start = start || (i >= startline && begin.test(line))
          if (!stop && (counter >= controls.count || end.test(line))) {
            stop = true
            st3.end()
          }
          if (start && !stop && line.length && !comment.test(line) && filter.test(line)) {
            res.push(line2arr(i, line))
            counter++
          }
        })
        .on("end", function () {
          d.resolve(res)
        })
      return d.promise
    }
  }

  connection.onopen = main

  connection.open()
}

module.exports = weblogFile
