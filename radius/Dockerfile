FROM freeradius/freeradius-server:latest-3.2

# The upstream "freeradius/freeradius-server" image ships config + client tools
# (radclient/radtest) but NOT the radiusd daemon — install it plus the MySQL
# module. Base is Ubuntu 22.04 with the FreeRADIUS project's own debs; the
# daemon binary is /usr/sbin/freeradius (radiusd was renamed upstream).
RUN apt-get update \
 && apt-get install -y --no-install-recommends freeradius freeradius-mysql \
 && rm -rf /var/lib/apt/lists/* \
 && ln -sfn /etc/freeradius /etc/raddb

# Templated configs (placeholders filled by entrypoint.sh from env vars).
COPY conf/clients.conf /etc/freeradius/clients.conf
COPY conf/mods-available/sql /etc/freeradius/mods-available/sql
RUN ln -sf ../mods-available/sql /etc/freeradius/mods-enabled/sql \
 && sed -i '/^[[:space:]]*-sql[[:space:]]*$/s/-sql/sql/' /etc/freeradius/sites-available/default \
 && mkdir -p /var/log/freeradius/radacct

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 1812/udp 1813/udp
ENTRYPOINT ["/entrypoint.sh"]