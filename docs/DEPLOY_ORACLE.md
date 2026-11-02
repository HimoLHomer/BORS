# Run BÖRS on an Oracle Cloud free server

This puts BÖRS online at your own HTTPS address, behind a password, on Oracle Cloud's
Always Free tier. Expect about an hour the first time.

What you end up with:

- BÖRS running 24/7 as a service, with your data in SQLite on the server's disk
- HTTPS via Caddy with an automatic certificate
- A login page (one password, sessions last 30 days)
- A daily database backup on the server, kept for 14 days

## 1. Create the Oracle Cloud account

1. Sign up at <https://www.oracle.com/cloud/free/>. A card is needed for identity checks; Always
   Free resources are not charged.
2. **Home region** is permanent and Always Free servers only run there. Pick one near you
   (for Finland: *EU North 1 (Stockholm)* or *Germany Central (Frankfurt)*).

## 2. Create the server

Console → **Compute → Instances → Create instance**:

| Setting | Value |
|---|---|
| Name | `bors` |
| Image | **Canonical Ubuntu 24.04** |
| Shape | **Ampere → VM.Standard.A1.Flex**, 1 OCPU, 6 GB memory (well within the free limit) |
| Networking | Create a new VCN and public subnet; **Assign a public IPv4 address** |
| SSH keys | **Generate a key pair** and download the private key (keep it safe) |

If you get *Out of capacity*, try another availability domain, or try again later.

Note the instance's **public IP address**.

## 3. Open ports 80 and 443 in Oracle's firewall

Console → **Networking → Virtual cloud networks →** your VCN → **Security lists → Default security list
→ Add ingress rules**, twice:

| Source CIDR | IP protocol | Destination port |
|---|---|---|
| `0.0.0.0/0` | TCP | `80` |
| `0.0.0.0/0` | TCP | `443` |

(The setup script opens the same ports in the server's own firewall.)

## 4. Get a free address (DuckDNS)

1. Sign in at <https://www.duckdns.org> and add a subdomain, e.g. `myborse` → `myborse.duckdns.org`.
2. Set its **current ip** to the server's public IP and click **update ip**.

## 5. Install BÖRS on the server

From your PC (PowerShell), connect with the key you downloaded:

```powershell
ssh -i C:\path\to\ssh-key.key ubuntu@<public-ip>
```

On the server:

```bash
curl -fsSL https://raw.githubusercontent.com/HimoLHomer/BORS/main/deploy/oracle/setup.sh -o setup.sh
sudo bash setup.sh myborse.duckdns.org
```

It asks for the login password (at least 10 characters, input hidden). When it prints
**Done**, open `https://myborse.duckdns.org` and sign in.

## 6. Move your data from the desktop app

1. Desktop app → **Options → Export JSON**.
2. Cloud BÖRS → **Options → Import JSON**, pick that file, confirm.

This brings holdings, history, buy/sale/cash entries, cash, and the dividend and FIRE settings.

## Everyday operations

| Task | Command (on the server) |
|---|---|
| Update to the latest version on GitHub | `sudo bash /opt/bors/deploy/oracle/update.sh` |
| See logs | `journalctl -u bors -n 100` |
| Restart | `sudo systemctl restart bors` |
| Change the password | `sudo rm /etc/bors/bors.env && sudo bash setup.sh <domain>` |
| Backups | `/var/lib/bors/backups/` (daily; also keep an occasional **Export JSON** on your PC) |

## Troubleshooting

- **Site doesn't load**: check both firewalls (step 3 and `sudo iptables -L INPUT -n`), and that
  DuckDNS points to the right IP.
- **Certificate errors right after setup**: wait a minute; Caddy fetches it on first visit.
  `journalctl -u caddy -n 50` shows why if it keeps failing.
- **Prices missing**: Yahoo sometimes limits requests from cloud servers. The **Retry** button in
  the header, or a few minutes' wait, usually clears it.
