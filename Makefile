.DELETE_ON_ERROR:

kernelName := purescript-webpack
nodejs := $(shell which node)
pursBin := $(shell dirname $(shell which purs))
workspace := $(shell pwd)

kernel: $(kernelName)/kernel $(kernelName)/kernel.json

$(kernelName)/kernel: output kernel.js
	mkdir -p $(kernelName)
	@echo "#! /usr/bin/env bash"            > $(kernelName)/kernel
	@echo "export PATH=$(pursBin):$$PATH"   >> $(kernelName)/kernel
	@echo "cd $(workspace)"                 >> $(kernelName)/kernel
	@echo 'exec $(nodejs) kernel.js ./ $$@' >> $(kernelName)/kernel
	chmod +x $(kernelName)/kernel

$(kernelName)/kernel.json:
	mkdir -p $(kernelName)
	@echo '{'                                              > $(kernelName)/kernel.json
	@echo '  "display_name": "Purescript + Webpack",'     >> $(kernelName)/kernel.json
	@echo '  "language": "purescript",'                   >> $(kernelName)/kernel.json
	@echo '  "argv": ["$(workspace)/$(kernelName)/kernel", "{connection_file}"]'   >> $(kernelName)/kernel.json
	@echo '}'                                             >> $(kernelName)/kernel.json

kernel.js: kernel.ts node_modules
	tsc

output: bower_components
	purs compile "bower_components/purescript-*/src/**/*.purs"

bower_components:
	cp --reflink=auto --no-preserve=mode -R $(bowerComponents)/bower_components .

node_modules: package.json
	npm install

packages:
	upgrade-bower-packages
	upgrade-node-packages

clean:
	rm -rf output
	rm -rf kernels
	rm -rf result
	rm -rf node_modules
	rm -rf bower_components
	rm *.js
	rm -rf $(kernelName)

install: kernel
	ln -s $(workspace)/$(kernelName) $(KERNELS_DIR)/$(kernelName)

.PHONY: clean packages kernel install
