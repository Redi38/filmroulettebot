import asyncio
import logging
import sys
import time
from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.fsm.storage.memory import MemoryStorage
from app.config import settings
from app.db.database import init_db
from app.routers import roulette, upcoming, dc_marvel, history
from app.services.tmdb import close_client
from app.services.watch_link import close_client as close_watch_link_client

logging.basicConfig(
    level=getattr(logging, settings.LOG_LEVEL.upper(), logging.INFO),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger(__name__)

HEARTBEAT_FILE = "/tmp/bot_heartbeat"
HEARTBEAT_INTERVAL = 30  # seconds
HEARTBEAT_PROBE_TIMEOUT = 10  # seconds


async def _heartbeat_loop(bot: Bot) -> None:
    while True:
        try:
            await asyncio.wait_for(bot.get_me(), timeout=HEARTBEAT_PROBE_TIMEOUT)
        except Exception as e:
            logger.warning("heartbeat: Telegram probe failed, skipping update: %s", e)
        else:
            try:
                with open(HEARTBEAT_FILE, "w") as f:
                    f.write(str(time.time()))
            except OSError as e:
                logger.warning("heartbeat: failed to write %s: %s", HEARTBEAT_FILE, e)
        await asyncio.sleep(HEARTBEAT_INTERVAL)


async def main() -> None:
    await init_db()
    bot = Bot(
        token=settings.TOKEN,
        default=DefaultBotProperties(parse_mode=ParseMode.HTML),
    )
    dp = Dispatcher(storage=MemoryStorage())
    dp.include_routers(roulette.router, upcoming.router, dc_marvel.router, history.router)
    logger.info("🚀 Bot started")
    heartbeat_task = asyncio.create_task(_heartbeat_loop(bot))
    try:
        await dp.start_polling(bot, allowed_updates=dp.resolve_used_update_types())
    finally:
        heartbeat_task.cancel()
        await close_client()
        await close_watch_link_client()


if __name__ == "__main__":
    asyncio.run(main())
