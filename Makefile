.DELETE_ON_ERROR:

kernel: output kernel.js

kernel.js: kernel.ts
	tsc
output: bower_components
	purs compile bower_components/**/*.purs

bower_components:
	cp --reflink=auto --no-preserve=mode -R $(bowerComponents)/bower_components .

node_modules: package.json
	npm install

packages:
	upgrade-bower-packages
	upgrade-node-packages

clean:
	rm -rf output
	rm -rf node_modules
	rm -rf bower_components
	rm *.js

.PHONY: clean packages kernel
