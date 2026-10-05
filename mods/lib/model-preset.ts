export function projectKey(root: string) {
  return `model:${root.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()}`
}

export function projectName(root: string) {
  return root.replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop() ?? root
}
