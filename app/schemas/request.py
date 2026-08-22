from pydantic import BaseModel, Field


class VerifyRequest(BaseModel):
    employee_id: str = Field(..., min_length=1, max_length=128)