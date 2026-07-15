#!/usr/bin/env node
// Copyright (c) 2026 Fair
// SPDX-License-Identifier: MIT


const fs = require('fs');
const path = require('path');

const root = __dirname;

// 读取 package.json
const packageJsonPath = path.join(root, 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

// 解析当前版本号并递增
const version = packageJson.version;
const versionParts = version.split('.').map(Number);
versionParts[2] = versionParts[2] + 1;
const newVersion = versionParts.join('.');

// 1. 更新 package.json
packageJson.version = newVersion;
fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, '\t') + '\n');

// 2. 更新 package-lock.json（根 version 字段）
const lockPath = path.join(root, 'package-lock.json');
if (fs.existsSync(lockPath)) {
    let lockContent = fs.readFileSync(lockPath, 'utf8');
    // 只替换根对象的 version 字段（第一个出现的 "version"）
    lockContent = lockContent.replace(
        /("version":\s*)"[\d.]+"/,
        `$1"${newVersion}"`
    );
    fs.writeFileSync(lockPath, lockContent, 'utf8');
}

// 3. 更新 README.md 中的版本 badge
const readmePath = path.join(root, 'README.md');
if (fs.existsSync(readmePath)) {
    let readme = fs.readFileSync(readmePath, 'utf8');
    readme = readme.replace(
        /version-\d+\.\d+\.\d+/,
        `version-${newVersion}`
    );
    fs.writeFileSync(readmePath, readme, 'utf8');
}

console.log(`✅ 版本号已更新: ${version} → ${newVersion}`);

module.exports = newVersion;
