import type { Configuration } from 'webpack';

import { rules } from './webpack.rules';
import { plugins } from './webpack.plugins';
import CopyPlugin from 'copy-webpack-plugin';
import path from 'path';

rules.push({
  test: /\.css$/,
  use: [{ loader: 'style-loader' }, { loader: 'css-loader' }],
});

// Monaco Editor 폰트(TTF 등) 로딩을 위한 Webpack 5 Asset Module 설정 추가
rules.push({
  test: /\.ttf$/,
  type: 'asset/resource',
});

export const rendererConfig: Configuration = {
  module: {
    rules,
  },
  plugins: [
    ...plugins,
  ],
  resolve: {
    extensions: ['.js', '.ts', '.jsx', '.tsx', '.css'],
    alias: {
      path: require.resolve('path-browserify'),
      'monaco-editor': path.resolve(__dirname, 'node_modules/monaco-editor'),
      'vscode/services': path.resolve(__dirname, 'src/renderer/vscode-mock.ts'),
      vscode: path.resolve(__dirname, 'src/renderer/vscode-mock.ts')
    },
    fallback: {
      path: require.resolve('path-browserify')
    }
  },
  // 웹팩 개발 서버의 에러 오버레이가 화면을 가리지 않도록 설정
  devServer: {
    client: {
      overlay: false,
    },
  } as any,
};
