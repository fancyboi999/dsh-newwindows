# dsh-newwindows Makefile 命令面薄封装
# 目标仅转发 package.json scripts，提供标准化开发门禁

.DEFAULT_GOAL := help

help: ## 列出所有可用目标
	@awk -F':.*## ' '/^[a-zA-Z0-9_-]+:.*## / {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: ## 安装依赖
	npm install

test: ## 运行单元测试与不变式套件
	npm test

test-e2e: ## 运行基于真实大模型的端到端测试
	npm run test:e2e

lint: ## 文档与规范静态检查
	npm run docs:lint

check: ## 聚合全量门禁（lint + test）
	npm run check

clean: ## 清理临时产物
	rm -rf dist/ build/ coverage/ .tmp/

.PHONY: help install test test-e2e lint check clean
