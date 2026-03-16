#!/bin/bash
# Voice Clone Studio 测试脚本

set -e  # 遇到错误时退出

echo "========================================"
echo "Voice Clone Studio 测试脚本"
echo "========================================"

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 函数：打印带颜色的消息
print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 检查是否在正确的目录
if [ ! -f "main.py" ]; then
    print_error "请在 backend 目录下运行此脚本"
    exit 1
fi

# 解析参数
ACTION="all"
VERBOSE=0
COVERAGE=0
QUICK=0

while [[ $# -gt 0 ]]; do
    case $1 in
        unit|integration|api|all|lint|types|coverage|install)
            ACTION="$1"
            shift
            ;;
        -v|--verbose)
            VERBOSE=1
            shift
            ;;
        -c|--coverage)
            COVERAGE=1
            shift
            ;;
        --quick)
            QUICK=1
            shift
            ;;
        -h|--help)
            echo "用法: $0 [命令] [选项]"
            echo ""
            echo "命令:"
            echo "  unit         运行单元测试"
            echo "  integration  运行集成测试"
            echo "  api          运行 API 测试"
            echo "  all          运行所有测试 (默认)"
            echo "  lint         运行代码检查"
            echo "  types        运行类型检查"
            echo "  coverage     运行测试并生成覆盖率报告"
            echo "  install      安装测试依赖"
            echo ""
            echo "选项:"
            echo "  -v, --verbose  显示详细输出"
            echo "  -c, --coverage 生成覆盖率报告"
            echo "  --quick        跳过慢速测试"
            echo "  -h, --help     显示帮助信息"
            exit 0
            ;;
        *)
            print_error "未知选项: $1"
            echo "使用 $0 --help 查看帮助"
            exit 1
            ;;
    esac
done

# 构建命令
CMD="python tests/run_tests.py $ACTION"

if [ $VERBOSE -eq 1 ]; then
    CMD="$CMD --verbose"
fi

if [ $COVERAGE -eq 1 ]; then
    CMD="$CMD --coverage"
fi

if [ $QUICK -eq 1 ]; then
    CMD="$CMD --quick"
fi

# 执行命令
print_info "执行命令: $CMD"
echo ""

# 运行命令
if eval $CMD; then
    echo ""
    print_success "测试执行成功"
    exit 0
else
    echo ""
    print_error "测试执行失败"
    exit 1
fi