/** URL of a workspace media asset, served by the `cmp-media://` protocol. */
export function mediaUrl(assetId: string): string {
  return `cmp-media://asset/${assetId}`;
}
