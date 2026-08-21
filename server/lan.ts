import os from 'node:os';

const SKIP = /vEthernet|WSL|VirtualBox|VMware|Tailscale|Bluetooth|Loopback|ZeroTier|Hyper-V|Docker|TAP|OpenVPN|WireGuard/i;

/** Best-guess LAN URLs for this machine, most likely first. */
export function lanUrls(port: number): string[] {
  const ifaces = os.networkInterfaces();
  const out: { url: string; score: number }[] = [];
  for (const [name, addrs] of Object.entries(ifaces)) {
    if (!addrs) continue;
    for (const a of addrs) {
      if (a.family !== 'IPv4' || a.internal) continue;
      if (a.address.startsWith('169.254.')) continue;
      let score = 0;
      if (SKIP.test(name)) score -= 10;
      if (a.address.startsWith('192.168.')) score += 5;
      else if (a.address.startsWith('10.')) score += 3;
      else if (/^172\.(1[6-9]|2\d|3[01])\./.test(a.address)) score += 2;
      if (/Wi-?Fi|WLAN|Ethernet/i.test(name)) score += 2;
      out.push({ url: `http://${a.address}:${port}`, score });
    }
  }
  return out.sort((a, b) => b.score - a.score).map((x) => x.url);
}
