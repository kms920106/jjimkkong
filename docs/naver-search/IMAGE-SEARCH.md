# 이미지 검색 결과 조회

`Classic/VPC` Classic/VPC 환경에서 이용 가능합니다.

네이버 검색의 이미지 검색 결과를 조회합니다.

> **참고**
> 이미지 검색은 검색 API를 사용하며, 검색 API의 하루 호출 한도는 25,000회입니다.

## 요청

요청 형식을 설명합니다. 요청 형식은 다음과 같습니다.

| 메서드 | URI |
|---|---|
| GET | `/search/v1/image` |

### 요청 헤더

NAVER API HUB에서 공통으로 사용하는 헤더에 대한 정보는 NAVER API HUB 요청 헤더를 참조해
주십시오.

### 요청 쿼리 파라미터

요청 쿼리 파라미터에 대한 설명은 다음과 같습니다.

| 필드 | 타입 | 필수 여부 | 설명 |
|---|---|---|---|
| `query` | String | Required | 검색어<br>- UTF-8로 인코딩 |
| `display` | Integer | Optional | 한 번에 표시할 검색 결과 개수<br>- 1 ~ 100 (기본값: 10) |
| `start` | Integer | Optional | 검색 시작 위치<br>- 1 ~ 1000 (기본값: 1) |
| `sort` | String | Optional | 검색 결과 정렬 방법<br>- `sim`(기본값) \| `date`<br>  - `sim`: 정확도 내림차순<br>  - `date`: 날짜 내림차순 |
| `filter` | String | Optional | 크기별 검색 결과 필터<br>- `all`(기본값) \| `large` \| `medium` \| `small`<br>  - `all`: 모든 이미지<br>  - `large`: 큰 이미지<br>  - `medium`: 중간 크기 이미지<br>  - `small`: 작은 크기 이미지 |
| `format` | String | Optional | 응답 형식<br>- `json`(기본값) \| `xml` |

### 요청 예시

요청 예시는 다음과 같습니다.

```shell
curl --location --request GET https://naverapihub.apigw.ntruss.com/search/v1/image \
--header X-NCP-APIGW-API-KEY-ID: {Client ID} \
--header X-NCP-APIGW-API-KEY: {Client Secret}
```

## 응답

응답 형식을 설명합니다.

### 응답 바디

응답 바디에 대한 설명은 다음과 같습니다.

| 필드 | 타입 | 필수 여부 | 설명 |
|---|---|---|---|
| `lastBuildDate` | String | - | 검색 결과를 생성한 시간 |
| `total` | Integer | - | 총 검색 결과 개수 |
| `start` | Integer | - | 검색 시작 위치 |
| `display` | Integer | - | 한 번에 표시할 검색 결과 개수 |
| `items` | Array | - | 개별 검색 결과 목록: [items](#items) |

#### items

`items`에 대한 설명은 다음과 같습니다.

| 필드 | 타입 | 필수 여부 | 설명 |
|---|---|---|---|
| `title` | String | - | 이미지가 검색된 문서의 제목 |
| `link` | String | - | 이미지의 URL |
| `thumbnail` | String | - | 섬네일 이미지의 URL |
| `sizeheight` | String | - | 이미지의 세로 크기(픽셀) |
| `sizewidth` | String | - | 이미지의 가로 크기(픽셀) |

### 응답 상태 코드

응답 상태 코드에 대한 설명은 다음과 같습니다.

| HTTP 상태 코드 | 코드 | 메시지 | 설명 |
|---|---|---|---|
| 400 | SE01 | Incorrect query request (잘못된 쿼리 요청입니다.) | API 요청 URL의 프로토콜, 파라미터 등에 오류가 있는지 확인 |
| 400 | SE02 | Invalid display value (부적절한 display 값입니다.) | `display` 값이 허용 범위인지 확인 |
| 400 | SE03 | Invalid start value (부적절한 start 값입니다.) | `start` 값이 허용 범위인지 확인 |
| 400 | SE04 | Invalid sort value (부적절한 sort 값입니다.) | `sort` 값에 오타가 있는지 확인 |
| 400 | SE06 | Malformed encoding (잘못된 형식의 인코딩입니다.) | 검색어를 UTF-8로 인코딩 |
| 404 | SE05 | Invalid search api (존재하지 않는 검색 api 입니다.) | API 요청 URL에 오타가 있는지 확인 |
| 500 | SE99 | System Error (시스템 에러) | 서버 내부에서 오류 발생 |

> **참고**
> NAVER API HUB에서 공통으로 사용하는 응답 상태 코드에 대한 설명은 NAVER API HUB 응답
> 상태 코드를 참조해 주십시오.

### 응답 예시

응답 예시는 다음과 같습니다.

```json
{
    "lastBuildDate": "Thu, 11 Jun 2026 18:43:28 +0900",
    "total": 25055897,
    "start": 1,
    "display": 2,
    "items": [
        {
            "title": "<b>커피</b> 한 잔과 원두",
            "link": "https://{imageHost}/{imagePath}.jpg",
            "thumbnail": "https://search.pstatic.net/sunny/?type=...",
            "sizeheight": "1023",
            "sizewidth": "682"
        },
        {
            "title": "<b>커피</b>와 책이 있는 정물",
            "link": "https://{imageHost}/{imagePath}.jpg",
            "thumbnail": "https://search.pstatic.net/sunny/?type=...",
            "sizeheight": "682",
            "sizewidth": "1023"
        }
    ]
}
```
