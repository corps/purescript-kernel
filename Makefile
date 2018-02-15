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
	bower install

node_modules:
	npm install

packages:
	@echo "This may take a bit, please be patient."
	upgrade-bower-packages
	upgrade-node-packages

clean: clean_keep_packages
	rm -rf node_modules
	rm -rf bower_components

clean_keep_packages:
	rm -rf output
	rm -rf kernels
	rm -rf result
	rm *.js 2> /dev/null || true
	rm -rf $(kernelName)

install: kernel
	ln -s $(workspace)/$(kernelName) $(KERNELS_DIR)/$(kernelName)

.PHONY: clean packages kernel install clean_keep_packages
