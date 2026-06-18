TODO

 - Add VRRP management maybe?
 - Fix runner (encypt dns)
 - Restrict sudo allowed commands to only what is needed
 - Maybe a user with a custom shell for security?
 - Seperate log files for domains

TEST
 - During initial adding of a host, provision the server with a dockerfleet user with whatever access is needed, also add a way to retrospectively enable this

DONE

 - Centralized Stacks: compose + env managed in app (encrypted secrets), deploy to hosts, import existing stacks
 - Add certificate expiration warnings (email alerts + auto-renew when < 30 days)
 - Improve polling efficiency and DB usage to prevent polling
 - Update updates cache after running an update so we don't have to ciick refresh on the update thing
 - Add Public WWW Frewall functionality for nodes
 - Taking two backups at a time
 - Email alerts not working
 - Add docker-compose.yml container install
 - Improve container selection in backups
