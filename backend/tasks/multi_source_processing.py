"""多源视频项目 Celery 任务。"""

import logging
import uuid
from typing import Any, Dict, Optional

from backend.core.celery_app import celery_app
from backend.pipeline.source_queue_runner import run_multi_source_queue_sync

logger = logging.getLogger(__name__)


@celery_app.task(bind=True, name="backend.tasks.multi_source_processing.process_multi_source_project")
def process_multi_source_project(self, project_id: str) -> Dict[str, Any]:
    task_id = self.request.id or str(uuid.uuid4())
    logger.info("开始多源项目队列: %s task=%s", project_id, task_id)
    result = run_multi_source_queue_sync(project_id, task_id=task_id)
    logger.info("多源项目队列结束: %s result=%s", project_id, result.get("success"))
    return result
