#!/usr/bin/env python3
"""
测试运行脚本
支持不同测试类型的运行和覆盖率报告
"""
import os
import sys
import subprocess
import argparse
from pathlib import Path


def run_command(cmd, description):
    """运行命令并显示输出"""
    print(f"\n{'='*60}")
    print(f"正在运行: {description}")
    print(f"命令: {cmd}")
    print('='*60)

    try:
        result = subprocess.run(cmd, shell=True, check=True, capture_output=True, text=True)
        print(result.stdout)
        if result.stderr:
            print("错误输出:", result.stderr)
        return True
    except subprocess.CalledProcessError as e:
        print(f"命令执行失败 (退出码: {e.returncode}):")
        print(e.stdout)
        if e.stderr:
            print("错误输出:", e.stderr)
        return False


def run_tests(test_type, coverage=False, verbose=False):
    """运行指定类型的测试"""
    base_dir = Path(__file__).parent.parent
    test_dir = base_dir / "tests"

    # 基本 pytest 命令
    cmd_parts = ["pytest"]

    # 添加 verbose 参数
    if verbose:
        cmd_parts.append("-v")

    # 添加测试类型
    if test_type == "unit":
        cmd_parts.append(str(test_dir / "unit"))
        cmd_parts.append("-m unit")
    elif test_type == "integration":
        cmd_parts.append(str(test_dir / "integration"))
        cmd_parts.append("-m integration")
    elif test_type == "api":
        cmd_parts.append(str(test_dir / "integration"))
        cmd_parts.append("-m api")
    elif test_type == "all":
        cmd_parts.append(str(test_dir))
    else:
        # 运行特定测试文件
        test_file = test_dir / f"{test_type}"
        if test_file.exists():
            cmd_parts.append(str(test_file))
        else:
            print(f"错误: 未找到测试文件 {test_file}")
            return False

    # 添加覆盖率参数
    if coverage:
        cmd_parts.extend([
            "--cov=app",
            "--cov-report=term",
            "--cov-report=html:coverage_html",
            "--cov-report=xml:coverage.xml"
        ])

    # 执行命令
    cmd = " ".join(cmd_parts)
    return run_command(cmd, f"{test_type} 测试")


def run_coverage_report():
    """生成覆盖率报告"""
    cmd = "coverage report"
    return run_command(cmd, "覆盖率报告")


def run_linting():
    """运行代码检查"""
    base_dir = Path(__file__).parent.parent

    # 运行 flake8
    flake8_cmd = f"flake8 {base_dir / 'app'} --max-line-length=100 --exclude=__pycache__,.venv"
    if not run_command(flake8_cmd, "代码风格检查 (flake8)"):
        return False

    # 运行 black 检查（不修改）
    black_cmd = f"black --check {base_dir / 'app'} --line-length=100"
    if not run_command(black_cmd, "代码格式化检查 (black)"):
        return False

    # 运行 isort 检查（不修改）
    isort_cmd = f"isort --check-only {base_dir / 'app'} --profile=black"
    if not run_command(isort_cmd, "导入排序检查 (isort)"):
        return False

    return True


def run_type_checking():
    """运行类型检查"""
    base_dir = Path(__file__).parent.parent
    cmd = f"mypy {base_dir / 'app'} --ignore-missing-imports"
    return run_command(cmd, "类型检查 (mypy)")


def install_test_dependencies():
    """安装测试依赖"""
    base_dir = Path(__file__).parent.parent
    requirements_file = base_dir / "requirements-test.txt"

    if requirements_file.exists():
        cmd = f"pip install -r {requirements_file}"
        return run_command(cmd, "安装测试依赖")
    else:
        print(f"错误: 未找到 requirements-test.txt 文件")
        return False


def main():
    """主函数"""
    parser = argparse.ArgumentParser(description="运行 Voice Clone Studio 测试")
    parser.add_argument(
        "test_type",
        nargs="?",
        default="all",
        choices=["unit", "integration", "api", "all", "lint", "types", "coverage", "install"],
        help="测试类型: unit(单元测试), integration(集成测试), api(API测试), "
             "all(所有测试), lint(代码检查), types(类型检查), "
             "coverage(覆盖率报告), install(安装测试依赖)"
    )
    parser.add_argument(
        "--coverage", "-c",
        action="store_true",
        help="运行测试时生成覆盖率报告"
    )
    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="显示详细输出"
    )
    parser.add_argument(
        "--quick",
        action="store_true",
        help="快速运行（不运行慢速测试）"
    )

    args = parser.parse_args()

    # 切换到项目根目录
    os.chdir(Path(__file__).parent.parent)

    # 根据参数执行相应操作
    if args.test_type == "install":
        success = install_test_dependencies()
    elif args.test_type == "lint":
        success = run_linting()
    elif args.test_type == "types":
        success = run_type_checking()
    elif args.test_type == "coverage":
        success = run_tests("all", coverage=True, verbose=args.verbose)
        if success:
            success = run_coverage_report()
    else:
        success = run_tests(args.test_type, coverage=args.coverage, verbose=args.verbose)

    # 输出结果
    print("\n" + "="*60)
    if success:
        print("✓ 测试执行成功")
        sys.exit(0)
    else:
        print("✗ 测试执行失败")
        sys.exit(1)


if __name__ == "__main__":
    main()