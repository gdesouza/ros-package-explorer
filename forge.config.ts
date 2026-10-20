import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerZIP } from '@electron-forge/maker-zip';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

const config: ForgeConfig = {
  packagerConfig: {
    name: 'ros-package-explorer',
    executableName: 'ros-package-explorer',
    asar: true,
  },
  makers: [
    new MakerZIP({}, ['linux']),
    new MakerDeb({
      options: {
        name: 'ros-package-explorer',
        productName: 'ROS Package Explorer',
        genericName: 'ROS Package Explorer',
        description: 'Read-only explorer for ROS package manifests, dependencies and files',
        categories: ['Development', 'Utility'],
        section: 'devel',
        maintainer: 'ROS Package Explorer contributors',
        homepage: 'https://example.invalid/ros-package-explorer',
        bin: 'ros-package-explorer',
      },
    }),
  ],
  plugins: [
    new VitePlugin({
      build: [
        { entry: 'src/main/main.ts', config: 'vite.main.config.ts', target: 'main' },
        { entry: 'src/preload/preload.ts', config: 'vite.preload.config.ts', target: 'preload' },
        { entry: 'src/worker/scanWorker.ts', config: 'vite.worker.config.ts', target: 'main' },
      ],
      renderer: [{ name: 'main_window', config: 'vite.renderer.config.ts' }],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
