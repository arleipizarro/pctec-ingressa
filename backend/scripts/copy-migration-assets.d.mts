export interface CopyMigrationAssetsOptions {
  readonly srcDir: string;
  readonly distDir: string;
}

export interface CopyMigrationAssetsResult {
  readonly copiedFiles: string[];
}

export declare function copyMigrationAssets(options: CopyMigrationAssetsOptions): CopyMigrationAssetsResult;
