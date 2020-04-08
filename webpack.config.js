var path = require('path');
var fs = require('fs');
var externalModules = {};
fs.readdirSync('node_modules')
    .filter(function(x) {
       return ['.bin'].indexOf(x) === -1;
  })
  .forEach(function(mod) {
    externalModules[mod] = 'commonjs ' + mod;
});
fs.readdirSync('node_modules/@dra2020')
  .forEach((mod) => {
    mod = '@dra2020/' + mod;
    externalModules[mod] = 'commonjs ' + mod;
  });

var libConfig = {
    entry: {
      library: './src/fn-fullpatchscan.ts'
	  },
    target: 'node',
    mode: 'development',
    output: {
        library: 'fullpatchscan',
        libraryTarget: 'umd',
        path: __dirname + '/dist',
        filename: 'fn-fullpatchscan.js'
    },

    // Enable source maps
    devtool: "source-map",

    externals: externalModules,

    module: {
		rules: [
			{ test: /\.node?$/, loader: 'node-loader' },
			{ test: /\.tsx?$/, loader: 'ts-loader' },
			{ test: /\.js$/, enforce: "pre", loader: "source-map-loader" }
		]
    },

    resolve: {
        extensions: [".webpack.js", ".web.js", ".ts", ".tsx", ".js"]
    }

};

/*
var testConfig = {
    entry: './test/test.ts',
    target: 'node',
    mode: 'development',
    output: {
        path: __dirname + '/dist',
        filename: 'test.js'
    },

    // Enable source maps
    devtool: "source-map",

	externals: externalModules,

    module: {
		rules: [
			{ test: /\.tsx?$/, use: 'ts-loader', exclude: /node_modules/ },
			{ test: /\.json$/, loader: 'json-loader', exclude: /node_modules/ },
			{ test: /\.js$/, enforce: "pre", loader: "source-map-loader" }
		]
    },

    resolve: {
        extensions: [".webpack.js", ".web.js", ".ts", ".tsx", ".js"]
    }

};
*/

module.exports = [ libConfig /*, testConfig */ ];
